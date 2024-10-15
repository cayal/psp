
class MarkupBarfer {
    associatedFilename
    rawMarkup = ''
    dom
    #associatedRoute
    #spans = []

    constructor(filename, routeName, addReloadScript = false) {
        this.#associatedRoute = routeName
        this.associatedFilename = filename

        const markup = readFileSync(this.associatedFilename, 'utf-8')
        this.rawMarkup = markup
        this.dom = new JSDOM(markup, { includeNodeLocations: true })

        if (addReloadScript) {
            const body = this.dom.window.document.querySelector("body")
            const bodyLocation = this.dom.nodeLocation(body)
            const markupWithScript = !bodyLocation
                ? markup.concat(RELOADER_SCRIPT)
                : [
                    markup.slice(0, bodyLocation.startTag.endOffset),
                    RELOADER_SCRIPT,
                    markup.slice(bodyLocation.startTag.endOffset),
                ].join('\n')

            this.rawMarkup = markupWithScript
            this.dom = new JSDOM(this.rawMarkup, { includeNodeLocations: true })
        }

        const topLevelRipoffTags = this.dom.window.document.querySelectorAll("slurp-tags:not(slurp-tags slurp-tags)")
        let cur = 0, next = 0
        topLevelRipoffTags.forEach(tag => {
            next = this.dom.nodeLocation(tag).startOffset
            this.#spans.push(new CleanMarkupSpan(this.rawMarkup.slice(cur, next), filename, routeName))
            cur = next

            next = this.dom.nodeLocation(tag).endOffset

            this.#spans.push(new RipoffProjection(this.rawMarkup.slice(cur, next), tag, routeName, this))
            cur = next
        })
        this.#spans.push(new CleanMarkupSpan(this.rawMarkup.slice(cur), filename, routeName))
    }
    
    *getMarkup() {
        for (let s of this.#spans) {
            process.stderr.write(`YIELDING | MarkupBarfer@${this.associatedFilename} for ${this.#associatedRoute}\n`)
            yield* s.getMarkup()
        }
    }
    
    *getAssociatedFilenames() {
        for (let s of this.#spans) {
            yield* s.getAssociatedFilenames()
        }
    }
}

class CleanMarkupSpan {
    #rawMarkup
    #containingFilename
    #forRouteName

    constructor(markup, containingFilename, forRouteName) {
        this.#rawMarkup = markup
        this.#containingFilename = containingFilename
        this.#forRouteName = forRouteName
    }

    *getMarkup() {
        process.stderr.write(`YIELDING | CleanMarkupSpan'${this.#rawMarkup.slice(0, 5)}...'@${this.#containingFilename} for ${this.#forRouteName}\n`)
        yield `<!-------clean span-------->\n${this.#rawMarkup}\n<!-------/clean span-------->`
    }

    *getAssociatedFilenames() {
        yield this.#containingFilename
    }
}

class RipoffProjection {
    #rawMarkup
    #el
    #fromFileName
    #forRouteName
    #puker

    /**
     * @type {MarkupBarfer}
     */
    #parent

    /**
     * 
     * @param {*} markup 
     * @param {HTMLElement} this.#el
     */
    constructor(markup, el, forRouteName, parent) {
        this.#parent = parent
        this.#rawMarkup = markup
        this.#el = el

        const from = this.#el.getAttribute("from")
        this.#fromFileName = from.replace(/^\./, WEBROOT)

        this.#forRouteName = forRouteName
        this.#puker = new MarkupBarfer(this.#fromFileName, this.#forRouteName)

        this.printValidations()

    }

    printValidations() {
        const dbgSnippetStart = this.#parent.dom.nodeLocation(this.#el).startTag.startOffset
        const dbgSnippetEnd = this.#parent.dom.nodeLocation(this.#el).startTag.endOffset
        const dbgLines = this.#parent.rawMarkup.slice(dbgSnippetStart, dbgSnippetEnd).split('\n').filter(x => !x.match(/^\s*$/))
        const dbgLineNo = this.#parent.dom.nodeLocation(this.#el).startTag.startLine
        const dbgDisplayNo = dbgLineNo - `\n${RELOADER_SCRIPT}\n`.split('\n').length + 1
        const dbgWhere = this.#parent.associatedFilename + ':' + dbgDisplayNo

        const lintWarn = (message) => {
            console.warn(`\n${dbgWhere}`)
            dbgLines.forEach(l => console.warn(`  ${l}`))
            dbgLines.forEach(l => console.warn(`  ${Array(l.length).fill('^').join('')}`))
            console.warn(`  > ${message}`)
        }

        console.info(`<slurp-tags> | Validating '${dbgWhere}'...`)

        const as = this.#el.getAttribute("as")
        if (!as) {
            lintWarn(`Missing as='some-tag-name' attribute.`)
            console.info(`(done)\n`)
            return
        }

        const asNameInvalid = (name) => (
            name.split('-').length < 2
            || name.toLowerCase() != name
        )
        if (asNameInvalid(as)) {
            lintWarn(`'${as}' should be a valid custom tag name.`)
            console.info(`(done)\n`)
            return
        }

        const appearances = this.#el.querySelectorAll(as)
        if (appearances.length == 0) {
            lintWarn(`<${as}> tag does not appear in children.`)
        }
        console.info(`(done)\n`)
    }

    *getMarkup() {
        yield `\n<!-- ${this.#rawMarkup.split('\n')[0]} -->\n`
        yield* this.#puker.getMarkup()
        yield "\n<!-- </slurp-tags> -->\n"
    }
    
    *getAssociatedFilenames() {
        yield* [this.#fromFileName, ...this.#puker.getAssociatedFilenames()]
    }
}