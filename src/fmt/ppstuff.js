import { formatWithOptions } from "util"
import { L } from './logging'

class PPStylin {
    #privates = {
        none      : '0',
        bold      : '1',
        underline : '4',
        inverse   : '7',
        strike    : '9',
        black     : '30',
        red       : '31',
        green     : '32',
        yellow    : '33',
        pink      : '34',
        purple    : '35',
        blue      : '36',
        white     : '37',
        bgblack   : '40',
        bgred     : '41',
        bggreen   : '42',
        bgyellow  : '43',
        bgpink    : '44',
        bgpurple  : '45',
        bgblue    : '46',
        bgwhite   : '47',
    }
    
    some(...stuff) { 
        return `\x1b[${stuff.map(s=>this.#privates[s]).filter(x=>!!x).join(';')}m` 
    }
    
    constructor(bstylin=true) {
        if (!bstylin) { 
            this.#privates = Object.fromEntries(
                Object.entries(this.#privates).map(([k, _])=>[k, '']))
            this.some = (..._) => ''
        }
    }

    get none()      { return this.some('none') }
    get bold()      { return this.some('bold') }
    get underline() { return this.some('underline') }
    get inverse()   { return this.some('inverse') }
    get strike()    { return this.some('strike') }
    get black()     { return this.some('black') }
    get red()       { return this.some('red') }
    get green()     { return this.some('green') }
    get yellow()    { return this.some('yellow') }
    get pink()      { return this.some('pink') }
    get purple()    { return this.some('purple') }
    get blue()      { return this.some('blue') }
    get white()     { return this.some('white') }
    get bgblack()   { return this.some('bgblack') }
    get bgred()     { return this.some('bgred') }
    get bggreen()   { return this.some('bggreen') }
    get bgyellow()  { return this.some('bgyellow') }
    get bgpink()    { return this.some('bgpink') }
    get bgpurple()  { return this.some('bgpurple') }
    get bgblue()    { return this.some('bgblue') }
    get bgwhite()   { return this.some('bgwhite') }
}

export const PP = (function() {
    const SPCSYM = '⎺' 
    const RETSYM = '↩️'
    const NULSYM = '␀'
    const UNDSYM = '⎕' 
    const styles = new PPStylin()
    const spaces = (s, what) => {
        return Array(typeof s == "number" ? s : s.length).fill(what ?? ' ').join('')
    }

    const padded = (s, w, what, left=false) => {
        s = s.toString()
        const delta = w - s.length > 0 ? w - s.length : 0
        return left ? spaces(delta, what) + s : s + spaces(delta, what)
    }

    const oneChar = (c, w=1) => {
        if (c === null || c === '') {
            c = NULSYM
        } else if (c === undefined) {
            c = UNDSYM
        } else if (c === '\n') {
            return padded(RETSYM, w+1)
        } else if (c === ' ') {
            c = SPCSYM
        } else {
            c = c.toString()
        }

        return padded(c, w)
    }
    
    const o = (o) => formatWithOptions({ colors: true }, o)
    const ar = (a) => '[' + a.map(s=>"'"+s+"'").join(", ") + ']'
    const keys = (o) => ar(Object.keys(o))

    /**
     * 
     * @param {string} s 
     * @param {number} n suffix width. Default 3 (10% dup odds at ~75 items), also sus that I should care about dup odds for a function declared in a pretty print helper. I wonder if somebody's about to use this for something more functionally significant than would be wise
     * @returns 
     */
    function shortcode(s='', n=3, sep='-') {
        const cashMoneyB64digits = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRS$TUVWXY¥Z0123456789'
        const prefix = !s.length ? '' : s.split('').map(x => oneChar(x)).join('')
        const suffix = Array(n).fill(0).map((_) => cashMoneyB64digits[Math.floor(Math.random()*64)]).join('')
        return `${prefix}${sep}${suffix}`
    }

    return {
        colors: styles, // I keep using the old name from before I added all the combination stuff
        styles,
        SPCSYM,
        RETSYM,
        NULSYM,
        UNDSYM,
        ar,
        o,
        keys,
        spaces,
        padded,
        oneChar,
        nostylin: () => {
            let nos = new PPStylin(false)
            return { ...PP, styles: nos, colors: nos}
        },
        shortcode
    }
}())

export function pprintProblem(title,
    lineno,
    msg,
    asError,
    citationText = { at: '', before: [], after: [] }
) {
    const MAXLEN = 60
    let _y = PP.styles.yellow
    let _r = PP.styles.yellow
    let _ø = PP.styles.none

    L.log('\n')
    let log = asError ? (s) => { L.log('\n' + _r + s + _ø) } : (s) => L.log('\n' + _y + s + _ø)

    const cite = structuredClone(citationText)
    
    if (cite.at.length > MAXLEN) {
        cite.at = cite.at.slice(0, MAXLEN-3) + '...'
    }
    
    for (let i = 0; i <  cite.before.length; i++) {
        if (cite.before[i].length > MAXLEN) {
            cite.before[i] = cite.before[i].slice(0, MAXLEN-3) + '...'
        }
    }

    for (let i = 0; i <  cite.after.length; i++) {
        if (cite.after[i].length > MAXLEN) {
            cite.after[i] = cite.before[i].slice(0, MAXLEN-3) + '...'
        }
    }
    
    const header = `|${title}:${lineno}|`
    log('/' + Array(header.length-1).fill('-').join(''))
    log(`|${title}:${lineno}|`)

    if (cite.at.length > 0) {
        log('|' + Array(header.length-1).fill('-').join(''))
        cite.before.forEach(l => log('|' + l))
        log('|' + cite.at)
        const underscore = asError ? '^' : '~'
        const wsStripped = [...cite.at.match(/(\s+)([^\s].*[^\s])/)]
        if (wsStripped) {
            log('|' +wsStripped[1] + Array(wsStripped[2].length).fill(underscore).join(''))
        } else {
            log('|' +Array(cite.at.length).fill(underscore).join(''))
        }
        cite.after.forEach(l => log('|' + l))
        log('|' + Array(Math.min(msg.length, 60)).fill('-').join(''))
    }

    log('| ' + msg)
    log('\\' + Array(msg.length).fill('-').join(''))
    log('\n')
    if (asError) {
        throw new Error(msg) 
    }
}

