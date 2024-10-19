import { PLink, LinkPeeps, LinkPeepLocator, LinkLocator, indeedHtml, PLinkLocable, Queried } from "../paths/linkPeeping"
import { CursedDataGazer, CursedLens } from "../textEditing/evilCurses"
import { PP, pprintProblem } from "../fmt/ppstuff.js"
import { FSPeep } from "../paths/filePeeping"
import { L } from "../fmt/logging"

const REASONABLE_TAG_LENGTH = 256

type RawSlurp = {
    sourceLineno: number,
    from: PLink & Queried & { type: 'html' },
    as: string
}

type PukableSlurp = RawSlurp & {
    pocket: PukableSlotPocket
}

type RawBurp<Sl extends RawSlurp> = {
    sym: symbol,
    tagName: Sl["as"],
    sourceStart: number,
    sourceEnd: number,
    sourceLineno: number,
    rawInnerMarkup: string,
    rawOpenTag: string,
    rawCloseTag: string,
    idAttr?: string
}

type RawSlot = {
    slotName: string,
    ownUname: string,
    rawMarkup: string,
    sourceLineno: number,
    sourceStart: number,
    sourceEnd: number
}

type ChunkFlavorTransformation = (halfBlownChunk: string) => string

type PukableBurp<Psl extends PukableSlurp> =
    & RawBurp<Psl>
    & {
        className: string,
        digestedOpenTag: string,
        digestedCloseTag: string,
        digestedInnerResidue: string,
        juiceProvider: Psl,
        chunkFlavorTransformation: ChunkFlavorTransformation
    }


type PukableBubble
    <B extends RawBurp<Sl>, Sl extends RawSlurp> =
    & RawBubble
    & {
        uniquingBy?: B["idAttr"]
        digestedMarkup: string
    }

// Bubbles are <{TAGNAME} slot="{SLOTNAME}">...</{TAGNAME}>
// or similar (any tag that names a slot, void tags OK too)
// As the name implies, they bubble to the top level of the 
// entrypoint's <psp-host> tag, and the entrypoint blows them 
// after the </template> and before the </psp-host> close tags.
type RawBubble =
    {
        containingBurp: RawBurp<RawSlurp>,
        sourceLineno: number,
        rawMarkup: string,
        slotAttr: string,
    }

type StyleChunks = {
    hostOuterStyles: Set<string>
    hostInnerStyles: Set<string>
}

export class PukableSlotPocket {

    uname
    rootLoc
    reprName
    slurpMarker: string
    burpBlockMarker: string
    styleBlockMarker: string
    juiceLensName: string

    #juiceLens: CursedLens
    #wholeFileLens: CursedLens
    #ownLocator: LinkLocator
    #ownLink: PLink & Queried & { type: 'html' }
    #includedFromChain

    #bolus: CursedDataGazer
    #chunks: CursedDataGazer[]

    #rawSlurps: RawSlurp[] = []
    #rawSlots: RawSlot[] = []
    #rawBurps: RawBurp<RawSlurp>[] = []
    #rawBubbles: RawBubble[] = []

    #pukableBurps: PukableBurp<PukableSlurp>[] = []
    #pukableBubbles: PukableBubble<RawBurp<RawSlurp>, RawSlurp>[] = []

    #slurpedSubPockets: PukableSlurp[] = []

    #styleContent: StyleChunks = { hostOuterStyles: new Set<string>(), hostInnerStyles: new Set<string>() }

    #validations: [number, string][] = []

    static slurpDeclFromPattern = /^<!slurp\s[^<>]*from=['"]?([^'"]+)['"]?[^<>]*>/
    static slurpDeclAsPattern = /^<!slurp\s[^<>]*as=['"]?([^'"]+)['"]?[^<>]*>/

    static voidBubblePattern = /<(area|base|br|col|command|embed|hr|img|input|keygen|link|meta|param|source|track|wbr)\s[^<>]*slot=['"]?([^<>"]+)['"]?[^<>]*>/g // sosumi
    static bubblePattern = /<([a-zA-Z0-9\-]+)\s[^<>]*slot=["']?([^<>"]+)['"]?[^<>]*>[^<]*<\/\1>/g

    static getBurpPatterns = (name) => ({
        presence: new RegExp(`<${name}(?:\\s*>|\\s[^<>]*>).*</${name}\\s*>`, 's'),
        entry: new RegExp(`^<${name}(?:\\s*>|\\s[^<>]*>)`),
        exit: new RegExp(`</${name}\\s*>$`),
    })

    constructor(rootLoc: PLinkLocable, targetPath: string | (PLink & Queried), includedFromChain = []) {

        this.rootLoc = rootLoc
        this.#ownLocator = typeof targetPath == 'string'
            ? rootLoc(targetPath) :
            rootLoc(targetPath.relpath)

        this.#ownLink = typeof targetPath == 'string'
            ? indeedHtml(this.#ownLocator('.'))
            : indeedHtml(targetPath)

        this.uname = PP.shortcode()
        this.reprName = `<PSP${this.uname} @="${this.#ownLink.relpath}">`

        const initStart = performance.now()

        this.#includedFromChain = includedFromChain

        const arrow = `\n|${PP.spaces(includedFromChain.length, '-')}>`
        L.log(`${arrow} ${this.reprName}...`)

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
        this.#bolus = markupData.gazer

        if (this.#ownLink.fragment) {
            if (!("fragments" in markupData.lensNames) || !markupData.lensNames.fragments[this.#ownLink.fragment]) {
                throw new ReferenceError(
                    `${targetPath} refers to fragment ${this.#ownLink.fragment},` +
                    `but file only includes ${PP.o(markupData.lensNames.fragments)}`)
            }

            this.juiceLensName = markupData.lensNames.fragments[this.#ownLink.fragment]
        } else if (markupData.hasBody) {
            this.juiceLensName = markupData.lensNames.body
        } else {
            this.juiceLensName = markupData.lensNames.wholeFile
        }

        this.#juiceLens = this.#bolus.getLens(this.juiceLensName)
        this.#wholeFileLens = markupData.gazer.getLens(markupData.lensNames.wholeFile)

        if (!this.#juiceLens) {
            this.#bolus.summonBugs()
            pprintProblem(this.reprName, 0, `${this.#bolus.id.description} is missing lens ${this.juiceLensName}.`, true)
        }

        let templ;
        if (templ = this.#juiceLens.image.match(/<template[ >]/)) {
            pprintProblem(this.reprName, templ[0].index, `Warning: Template tags not supported in PSP and they will be shunned.`, false)
            let templateBlockMarker = PP.shortcode('template')
            this.#juiceLens.dichotomousJudgement({
                entryPattern: /<template[ >]/,
                exitPattern: '</template>',
                lookaheadN: REASONABLE_TAG_LENGTH,
                sigil: templateBlockMarker
            })
            this.#juiceLens.refocus({ creed: { [templateBlockMarker]: 'shun' } })
        }

        this.suckSlurps()

        this.sniffRawSlots()

        this.gobbleRawBurps()

        this.suckRawBubbles()

        this.slurpSubPockets()

        this.digestRawBurps()

        this.gulpAndDigestStyles()

        const initEnd = performance.now()
        L.log(`${arrow} Done (${(initEnd - initStart).toFixed(2)} ms).\n`)
        for (let line of this.debugRepr()) {
            L.log('\n' + line)
        }
    }

    /**
     * Considerations with styles:
     * 1) They'll be concatenated to a single <style> tag. Since they get added
     *      to the set from the oustide in and top down, this equates to
     *      flattening the puke tree depth-first. The same-specificity rule will
     *      apply accordingly in the final document.
     *
     * 2) The return type of deepGetStyleContent is a set, so only one of each
     *      unique style contents will be in the final document.
     * 
     * @param styleset 
     * @returns 
     */
    deepGetStyleContent(styleset: StyleChunks = { hostInnerStyles: new Set(), hostOuterStyles: new Set() }): StyleChunks {
        this.#styleContent.hostOuterStyles.forEach(sc => styleset.hostOuterStyles.add(sc))
        this.#styleContent.hostInnerStyles.forEach(sc => styleset.hostInnerStyles.add(sc))

        for (let { pocket } of this.#slurpedSubPockets) {
            let { hostOuterStyles, hostInnerStyles } = pocket.deepGetStyleContent(styleset)
            hostOuterStyles.forEach(sc => styleset.hostOuterStyles.add(sc))
            hostInnerStyles.forEach(sc => styleset.hostInnerStyles.add(sc))
        }

        return styleset
    }

    get ownFilename() {
        return this.#ownLink.relpath
    }

    suckRawBubbles() {
        const voidBubbles = this.#juiceLens.lensedCaptureAll(PukableSlotPocket.voidBubblePattern)
        const bubbles = this.#juiceLens.lensedCaptureAll(PukableSlotPocket.bubblePattern)

        for (let { startTruth, endTruth, endSourceLine, groups } of [...voidBubbles, ...bubbles]) {
            let containingBurp
            if (!(containingBurp = this.#rawBurps.find(b => (b.sourceStart <= startTruth) && (b.sourceEnd >= endTruth)))) {
            } else {
                this.#rawBubbles.push({
                    sourceLineno: endSourceLine,
                    rawMarkup: groups[0],
                    slotAttr: groups[2],
                    containingBurp
                })
            }
        }
    }

    breakBolusByRawBurpBlocks() {
        if (this.#rawBurps.length === 0) {
            return [this.#bolus]
        }
        let chunks = this.#bolus.shatterBySigil(this.burpBlockMarker)
        return chunks
    }

    suckSlurps() {
        const slurpPattern = /<!slurp [^>]*>/g

        this.slurpMarker = 'slurp' + this.uname

        const slurpDecls = this.#wholeFileLens.lensedCaptureAll(slurpPattern)

        for (let { startTruth, endTruth, endSourceLine, groups } of slurpDecls) {
            this.#bolus.brandRange(this.slurpMarker, startTruth, endTruth)
            let chars = groups[0]

            // The `from` attribute is required...
            let match: RegExpMatchArray;
            if (!(match = chars.match(PukableSlotPocket.slurpDeclFromPattern))) {
                const vmsg = `Missing 'from' attribute in slurp tag.`
                pprintProblem(this.#ownLink.relpath, endSourceLine, vmsg, false)
                this.#validations.push([endSourceLine, vmsg])
                continue
            }

            // And needs to resolve to a valid HTML file.
            let subHtml;
            try {
                subHtml = indeedHtml(this.#ownLocator(match[1]))
            } catch (e) {
                const vmsg = `Can't resolve '${match[1]}': ${e}`
                pprintProblem(this.#ownLink.relpath, endSourceLine, vmsg, false, this.#bolus.takeLines(endSourceLine, 3, 3))
                this.#validations.push([endSourceLine, 'File not found'])
                continue
            }

            // The `as` attribute is also required...
            if (!(match = chars.match(PukableSlotPocket.slurpDeclAsPattern))) {
                const vmsg = `Missing 'as' attribute in slurp tag.`
                pprintProblem(this.#ownLink.relpath, endSourceLine, vmsg, false)
                this.#validations.push([endSourceLine, vmsg])
                continue
            }

            let asName = match[1]

            // And ought to be usable as a custom tag name.
            if (asName.match(/[A-Z]/) || !asName.includes('-')) {
                const vmsg = `Lint: Custom tag names must be lowercase with 1+ hyphens: '${asName}'`
                pprintProblem(this.#ownLink.relpath, endSourceLine, vmsg, false)
                this.#validations.push([endSourceLine, vmsg])
            }

            this.#rawSlurps.push({
                sourceLineno: endSourceLine,
                from: subHtml,
                as: asName
            })
        }


        return
    }

    sniffRawSlots() {
        const slotOpenPattern = /^<slot [^<>]*name=['"]([^'"]+)['"][^<>]*>/
        const slotClosePattern = /<\/slot[^<>]*>$/
        const ownUname = PP.shortcode('-')
        const thisSlotMarker = `rawSlot${this.uname}${ownUname}`

        let slots;
        slots = this.#juiceLens.dichotomousJudgement({
            entryPattern: slotOpenPattern,
            exitPattern: slotClosePattern,
            sigil: thisSlotMarker,
            lookaheadN: REASONABLE_TAG_LENGTH,
            lookbehindN: REASONABLE_TAG_LENGTH
        })

        for (let { chars, startSourceLine, sourceStart, sourceEnd } of slots) {
            let match
            if ((match = chars.match(slotOpenPattern)) && (match?.[1]?.length > 0)) {
                this.#rawSlots.push({
                    slotName: match[1],
                    ownUname: ownUname,
                    rawMarkup: chars,
                    sourceLineno: startSourceLine,
                    sourceStart,
                    sourceEnd
                })
            } else {
                pprintProblem(this.#ownLink.relpath, startSourceLine, `Missing 'name' attribute in slot tag.`, true)
            }
        }

    }

    gulpAndDigestStyles() {
        this.styleBlockMarker = PP.shortcode('style')
        const outerRulePattern = /^\s+((html|head|body)({|[ .[:+~|>#][^{]*){[^}]+})/gm
        const univRulePattern = /^\s+(\*({|[ .[:+~|>#][^{]*){[^}]+})/gm
        let elementSelectorPattern = (
            (burpTagName: string) =>
                new RegExp(`([ >+~&])(${burpTagName})`, 'g')
        );

        const styleTags = this.#juiceLens.dichotomousJudgement({
            entryPattern: /^<style(>| [^<>]*>)/,
            exitPattern: '</style>',
            lookaheadN: REASONABLE_TAG_LENGTH,
            sigil: this.styleBlockMarker
        })

        for (let { chars } of styleTags) {
            let styleInnerContent = chars
                .replace(/^<style(>| [^<>]*>)/, '')
                .replace('</style>', '')

            let styleInnerRules = styleInnerContent.split('')

            let outerRules = styleInnerContent.matchAll(outerRulePattern)
            for (let oru of [...outerRules].reverse()) {
                styleInnerRules.splice(oru.index, oru[0].length);
                let ruleToAdd = oru[0];
                burpTagSwap: for (let pb of this.#pukableBurps) {
                    let pat = elementSelectorPattern(pb.tagName), m
                    if (m = ruleToAdd.match(pat)) {
                        ruleToAdd.replace(pb.tagName, `.${pb.className}`)
                        break burpTagSwap
                    }
                }
                this.#styleContent.hostOuterStyles.add(ruleToAdd)
            }

            styleInnerContent = styleInnerRules.join('')

            // Universal rules will be duplicated inside and outside the host
            let univRules = styleInnerContent.matchAll(univRulePattern)
            for (let uru of [...univRules].reverse()) {
                let ruleToAdd = uru[0]
                burpTagSwap: for (let pb of this.#pukableBurps) {
                    let pat = elementSelectorPattern(pb.tagName), m
                    if (m = ruleToAdd.match(pat)) {
                        ruleToAdd.replace(pb.tagName, `.${pb.className}`)
                        break burpTagSwap
                    }
                }
                this.#styleContent.hostOuterStyles.add(ruleToAdd)
            }


            // Finally, swap the inner rules (which share space together
            // in the remainder of the original string) with the same
            // burp tag name approach.
            for (let pb of this.#pukableBurps) {
                let pat = elementSelectorPattern(pb.tagName)
                let matches = styleInnerContent.matchAll(pat)
                for (let m of [...matches].reverse()) {
                    styleInnerContent = [
                        styleInnerContent.slice(0, m.index + m[1].length),
                        `.${pb.className}`,
                        styleInnerContent.slice(m.index + m[0].length)
                    ].join('')
                }
            }

            this.#styleContent.hostInnerStyles.add(styleInnerContent)
        }
    }

    gobbleRawBurps() {
        this.burpBlockMarker = 'rawBurp' + this.uname

        for (let slurpN of this.#rawSlurps) {
            let { presence, entry, exit } = PukableSlotPocket.getBurpPatterns(slurpN.as)

            let match;
            // Warn if there's a declared burp in a slurp that goes unused.
            if (!(match = this.#juiceLens.image.match(presence))) {
                const vmsg = `Lint: Unused burp: <${slurpN.as}>`

                pprintProblem(this.#ownLink.relpath,
                    slurpN.sourceLineno,
                    vmsg,
                    false,
                    this.#bolus.takeLines(slurpN.sourceLineno, 2, 2)
                )
                this.#validations.push([slurpN.sourceLineno, vmsg])

                continue
            }

            // Burp tag is present in the juice lens image, so
            // brand all usages of it with the burp block marker.
            const slurpNburpBlocks = this.#juiceLens.dichotomousJudgement({
                entryPattern: entry,
                exitPattern: exit,
                sigil: this.burpBlockMarker,
                encompass: true,
                lookaheadN: 512,
                lookbehindN: 512
            })

            for (let { chars, startSourceOffset, endSourceOffset, startSourceLine } of slurpNburpBlocks) {
                let openTag = chars.match(entry)[0]
                let closeTag = chars.match(exit)[0]
                let id = openTag.match(/id=["']([^'"]+)["']/)
                let idAttr = id?.[1] || ''
                let tagName = slurpN.as

                this.#rawBurps.push({
                    sym: Symbol(`${tagName}${idAttr ? '#' + idAttr : ''}`),
                    sourceStart: startSourceOffset,
                    sourceEnd: endSourceOffset,
                    sourceLineno: startSourceLine,
                    rawInnerMarkup: chars.replace(openTag, '').replace(closeTag, ''),
                    rawOpenTag: openTag,
                    rawCloseTag: closeTag,
                    tagName,
                    idAttr
                })
            }
        }

        // Burp blocks will be shunned after their bubbles are gobbled.

        return
    }

    slurpSubPockets() {
        for (let s of this.#rawSlurps) {
            let subPocket = new PukableSlotPocket(
                this.rootLoc,
                s.from,
                [...this.#includedFromChain, this])

            this.#slurpedSubPockets.push({
                ...s,
                pocket: subPocket
            })

            let subpocketSlots = subPocket.deepGetRawSlots()
            for (let susl of subpocketSlots) {
                if (this.#rawBubbles.every(rs => rs.slotAttr !== susl.slotName)) {
                    const vmsg = `unfilled slots: ${susl.slotName}.`
                    pprintProblem(this.#ownLink.relpath, susl.sourceLineno, vmsg, false)
                    this.#validations.push([susl.sourceLineno, vmsg])
                }
            }
        }
    }

    digestBubbles() {
        if (this.#pukableBubbles.length) { return this.#pukableBubbles }
        for (let rb of this.#rawBurps) {
            let burpBubbles = this.#rawBubbles.filter(bub => bub.containingBurp === rb)
            for (let bb of burpBubbles) {
                let digestedSlotAttr = bb.slotAttr
                let digestedMarkup = bb.rawMarkup
                if (rb.idAttr) {
                    digestedSlotAttr = rb.idAttr + '-' + bb.slotAttr
                    digestedMarkup = digestedMarkup.replace(/slot=["']([^'"]+)["']/, `slot="${digestedSlotAttr}"`)
                }
                this.#pukableBubbles.push({ ...bb, uniquingBy: rb.idAttr, digestedMarkup })
            }
        }

        return this.#pukableBubbles
    }

    digestRawBurps() {
        this.#pukableBurps = this.#rawBurps.map(rb => this.digestBurp(rb))
    }

    #digestRawBurpOpenTag(rb: RawBurp<RawSlurp>): { digestedOpenTag: string, className: string } {
        let modified = rb.rawOpenTag
        modified = modified.replace(`<${rb.tagName}`, '<div')

        let className = `${rb.tagName}${this.uname}`
        let clam;
        if (clam = modified.match(/(class=["']?)([^'"]+)["']/)) {
            modified = [
                modified.slice(0, clam.index + clam[1].length),
                className + ' ',
                modified.slice(clam.index + clam[1].length)
            ].join('\n')
        } else {
            const ins = modified.indexOf('>')
            modified = modified.slice(0, ins) + ` class="${className}">`
        }

        return {
            digestedOpenTag: modified,
            className: className
        }
    }

    #curriedRegurgitator(rb: RawBurp<RawSlurp>): ChunkFlavorTransformation {
        if (!rb.idAttr) {
            return (halfBlownChunk: string) => halfBlownChunk
        } else {
            const slotnamePattern = new RegExp(/(<slot\s[^<>]*name=['"]?)([^'"]+)['"]?/g)
            const prefix = rb.idAttr

            return (halfBlownChunk: string) => {
                let bits = halfBlownChunk.split('')
                let matches = [...halfBlownChunk.matchAll(slotnamePattern)].reverse()
                for (let m of matches) {
                    bits.splice(m.index + m[1].length, 0, prefix + '-')
                }

                return bits.join('')
            }
        }
    }

    digestBurp(rb: RawBurp<RawSlurp>): PukableBurp<PukableSlurp> {
        let juiceProvider = this.#slurpedSubPockets.find(ssp => ssp.as === rb.tagName)
        if (!juiceProvider) {
            throw new ReferenceError(`${rb.tagName} wanted, ${this.#slurpedSubPockets.map(s => s.as)} available`)
        }

        let { digestedOpenTag, className } = this.#digestRawBurpOpenTag(rb)
        let digestedCloseTag = rb.rawCloseTag.replace(`${rb.tagName}`, 'div')

        let digestedInnerResidue = rb.rawInnerMarkup.replaceAll(/<.*>[^<>]*<.*>/g, '')

        // Residual concatenation end up being useful, so disabling this warning.
        // if (digestedInnerResidue.replaceAll(/\s/g, '').length) {
        //     const vmsg = `Burp contains some unslotted residue.`

        //     pprintProblem(this.#ownLink.relpath, 
        //         rb.sourceLineno, 
        //         vmsg, 
        //         false, 
        //         this.#bolus.takeLines(rb.sourceLineno, 0, 4)
        //     )
        //     this.#validations.push([rb.sourceLineno, vmsg])
        // }

        let chunkFlavorTransformation = this.#curriedRegurgitator(rb)

        return {
            ...rb,
            className,
            digestedOpenTag,
            digestedCloseTag,
            digestedInnerResidue,
            juiceProvider,
            chunkFlavorTransformation
        }
    }

    deepGetAssocFilenames() {
        return [
            this.#ownLink.relpath,
            ...this.#slurpedSubPockets.flatMap(x => x.pocket.deepGetAssocFilenames()),
        ]
    }

    deepGetRawSlots(): RawSlot[] {
        return [...this.#rawSlots, ...Object.values(this.#slurpedSubPockets).flatMap(s => s.pocket.deepGetRawSlots())]
    }

    deepGetPukableBubbles(): PukableBubble<RawBurp<RawSlurp>, RawSlurp>[] {

        this.digestBubbles()

        return [...this.#pukableBubbles, ...Object.values(this.#slurpedSubPockets).flatMap(s => s.pocket.deepGetPukableBubbles())]
    }

    #debugLetters = ("ABCDEFGHIJKLMNOPQRSTUVWXYZあいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん".split(''));

    // Chunks are ready to blow when all burp blocks are barfable and the bolus can be broken.
    *blowChunks(regurgitate: ChunkFlavorTransformation = (s) => s) {
        this.#juiceLens.refocus({ creed: { [this.slurpMarker]: 'shun' } })
        this.#juiceLens.refocus({ creed: { [this.styleBlockMarker]: 'shun' } })
        this.#juiceLens.refocus({ creed: { [this.burpBlockMarker]: 'shun' } })

        let chunks = this.breakBolusByRawBurpBlocks()

        // Styles and bubbles are going to go before and after the PSP content, respectively,
        // so we don't need to worry about them.
        // 
        // We do need to output, in order:
        // The chunk up to Burp A
        // Burp A, digested 
        //   A(1) <tag-name> -> <div> 
        //   A(2) all slots digested: slot name="X" becomes slot name="X+idAttr")

        for (let i = 0; i < chunks.length; i++) {
            yield regurgitate(chunks[i].getLens(this.juiceLensName).image)
            if (this.#pukableBurps[i]) {
                let burp = this.#pukableBurps[i]
                yield burp.digestedOpenTag
                yield* burp.juiceProvider.pocket.blowChunks(burp.chunkFlavorTransformation)
                if (burp.digestedInnerResidue) {
                    yield burp.digestedInnerResidue
                }
                yield burp.digestedCloseTag
            }
        }
    }

    *debugRepr(depth = 0, bubblesFromAbove: RawBubble[] = [], burpLetters = { ring: this.#debugLetters }) {
        let ind = PP.spaces(depth * 2)
        yield ind + PP.styles.pink + this.reprName + PP.styles.none

        let _p = PP.styles.pink
        let _u = PP.styles.purple
        let _g = PP.styles.green
        let _y = PP.styles.yellow
        let _ø = PP.styles.none

        const burpStylin = (s) => `<${_u + s + _ø}>`;
        const slotStylin = (s) => `[${_y + s + _ø}]`;

        for (let b of this.#rawBurps) {
            let l_t = burpLetters.ring.shift()

            burpLetters[b.sym] = l_t

            let leadup = ind + `|- ${l_t}:${b.sourceLineno} `

            yield _p + leadup + _ø + burpStylin(b.sym.description)

            burpLetters.ring.push(l_t)

            let burpBubbles = this.#rawBubbles.filter(bb => bb.containingBurp.sym == b.sym)

            for (let bs of burpBubbles) {
                let sp = PP.spaces(leadup.length)
                let stick = '|-' + _ø
                let innerCon = bs.rawMarkup.match(/>(.*)</)[1]
                let valPeek = innerCon.slice(0, 20) + (innerCon.length > 20 ? '[...]' : '')
                yield `${_p}|${sp}${stick}${slotStylin(bs.slotAttr)}: ${valPeek}`

            }
        }

        for (let sl of this.#rawSlots) {
            let bubbed = bubblesFromAbove
                .filter(bb => bb.slotAttr == sl.slotName)
                .map(bb => burpStylin(burpLetters[bb.containingBurp.sym]))
                .join('-')
            yield ind + `${_p}|-${_ø} * ${slotStylin(sl.slotName)}` + (bubbed.length ? '<-' + bubbed : '')
        }

        for (let { as, pocket } of this.#slurpedSubPockets) {
            let { sourceLineno } = this.#rawSlurps.find(rs => rs.as == as)
            let stick = `${_p}|--${_ø}`
            yield ind + `${stick} <!${_g}slurp @ ln ${sourceLineno}${_ø}>`
            for (let ln of pocket.debugRepr(depth + 2, [...bubblesFromAbove, ...this.#rawBubbles], burpLetters)) {
                yield _p + '|' + _ø + ln
            }
        }

        for (let [ln, msg] of this.#validations) {
            let exclamation = PP.styles.some('yellow', 'inverse') + ' ! ' + PP.styles.none
            let lineinfo = ln !== null ? `@ line ${ln}` : ''
            let stick = _p + '|--' + _ø
            yield ind + stick + exclamation + `->  ${PP.styles.yellow}${msg}${lineinfo}\n`
        }
        yield ind + _p + '|' + PP.spaces(20 - ind.length - depth, '_') + `.${this.uname}` + _ø

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
        let link1 = LinkPeepLocator(links)
        expect("reason" in link1).toBe(false)
        psp1 = new PukableSlotPocket(link1, 'testdata/psp')
    })

    test('Pockets slurped; Pockets in comments not slurped', () => {
        expect(psp1.deepGetAssocFilenames()).toStrictEqual(['testdata/psp/index.html', 'testdata/psp/inclusion.html'])
        console.log([...psp1.blowChunks()])
        expect([...psp1.blowChunks()]).toStrictEqual(
            [`\n\n<p>The main thing</p>\n\n`,
                `<div>`,
                `<h3>Included</h3>\n<p><slot name=\"theslot\">...</slot></p>`,
                `\n    \n`,
                `</div>`,
                ``
            ])
    })
}