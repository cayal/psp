import { createServer } from 'net';
import { createSecureServer } from 'node:http2'
import { Stats, existsSync, readFileSync, readdirSync, statSync, watch } from 'node:fs';
import path, { dirname } from 'node:path';
import { MessageChannel } from 'node:worker_threads'
import assert from 'node:assert';
import { PukableEntrypoint } from './entrypointStreaming';
import { HData, LinkPeeps, LinkPeepLocator, PLink, QF, PLinkLocable } from './linkPeeping';
import { PukableSlotPocket } from './htmlSlotPocketing';
import { FSPeep, FSPeepRoot } from './filePeeping';
import { PP } from './ppstuff.js';

process.stderr.write(`Hi (${process.pid})\n`)

let cannotPuke = false

const WEBROOT = 'src'
const RELOADER_SCRIPT = `\n<script>\n` +
    `const _tryConnect = (() => { \n` +
    `  if (!(window._updateSource) || (window._updateSource?.readyState === 3)) {\n` +
    `    console.info('Trying to connect to source update notifier...');\n` +
    `    if (window._updateSource = new WebSocket('ws://localhost/_updates')) {\n` +
    `      console.info('Connected');\n` +
    `      window._updateSource.onmessage = ((ev) => { \n` +
    `        console.info(ev)\n` +
    `        if (ev.data == new URL(window.location).pathname) {\n` +
    `          console.log("Page changed. Refreshing...")\n` +
    `          window.location.reload()\n` +
    `        }\n` +
    `      });\n` +
    `    }\n` +
    `  }\n` +
    `});\n` +
    `_tryConnect();\n` +
    `setInterval(_tryConnect, 5000);\n` +
    `</script>\n`

const { port1: changeReceiver, port2: changeTransmitter } = new MessageChannel()

performance.mark('A')
const webrootDir = FSPeepRoot({ entrypoint: WEBROOT })
performance.mark('B')

performance.measure('Built file tree in', 'A', 'B')

process.stderr.write(`Serving from: ${webrootDir.relpath}\n`)
for (let l of webrootDir.repr()) {
    process.stderr.write(l)
}

webrootDir.getWatcher(changeTransmitter)

const obs = new PerformanceObserver((items) => {
    process.stderr.write(`${items.getEntries()[0].name} in ${items.getEntries()[0].duration} ms\n`);
    performance.clearMarks();
});

obs.observe({ type: 'measure' });


function enumerateIndexes(peep: FSPeep) {
    if (peep.imp == 'd') {
        return peep
            .getDescendants()
            .flatMap(enumerateIndexes)
    }
    else if (peep.relpath.split('/').slice(-1)?.[0] == 'index.html') {
        return [peep]
    } else {
        return []
    }
}


const server = createSecureServer({
    maxSessionMemory: 1000,
    allowHTTP1: true,
    key: readFileSync('localhost-key.pem'),
    cert: readFileSync('localhost.pem'),
})

const idxFSPeeps = webrootDir.peepReduce(((acc, peep) => peep.path.base == 'index.html' ? acc.concat(peep) : acc), [])
process.stderr.write(PP.styles.pink + `\n> Using ${PP.ar(idxFSPeeps.map((i: any) => i.relpath))} as entrypoints. \n` + PP.styles.none)
const webpathsToPukers = {}
const relpathsToPukers = {}

const buildOne = (loc: PLinkLocable, fromPeep: PLink) => {
    const entrypoint = new PukableEntrypoint(loc, fromPeep.relpath, undefined, RELOADER_SCRIPT)

    // const pukerData = { fst: iPeep, pLinks, pLink, entrypoint }
    return null //pukerData
}

const pLinks = LinkPeeps({ entrypoint: webrootDir })
const loc = LinkPeepLocator(pLinks)
buildOne(loc, pLinks.links.find(l => l.relpath === 'src/index.html'))
console.log("Ending it here ")
process.exit(0)
const build = (relpathToBuild?: string) => {
    // Make fresh LinkPeeps, since files might have been created/deleted.
    const pLinks = LinkPeeps({ entrypoint: webrootDir })
    const loc = LinkPeepLocator(pLinks)

    const buildSet = relpathToBuild ? [pLinks.links.find(l => l.relpath === relpathToBuild)] : idxFSPeeps
    if (!buildSet) {
        console.error('Nothing to build.')
        cannotPuke = true;
        return
    }

    try {
        for (let iPeep of buildSet) {
            let { pLink, entrypoint } = buildOne(loc, iPeep)

            webpathsToPukers[pLink.webpath] = { ifst: iPeep, pLink, entrypoint }
            const relpaths = entrypoint.getAssociatedFilenames()
            for (let rp of relpaths) {
                if (!relpathsToPukers[rp]) {
                    relpathsToPukers[rp] = [{ ifst: iPeep, pLink, entrypoint }]
                } else {
                    relpathsToPukers[rp].push({ ifst: iPeep, pLink, entrypoint })
                }
            }
        }
    } catch (e) {
        console.error(e)
        console.error("Ran into a problem building files.")
        cannotPuke = true
    }
    return pLinks
}

let pppLinks = build()

changeReceiver.addEventListener("message", (ev) => {
    let [mode, relpath] = ev.data.split(" ")
    if (mode == "change") {
        build(relpath)
        changeTransmitter.postMessage(`built ${relpath}`)
    }
})

server.on('stream', (stream, headers) => {
    if (headers[':method'] != 'GET') {
        stream.respond({
            'content-type': 'text/html; charset=utf-8',
            ':status': 501,
        });
        stream.write('Not implemented')
        stream.end()
    }

    const path = headers[':path'] || '/'

    let fileMatch
    let chunkProvider
    if (chunkProvider = webpathsToPukers[path]) {
        stream.respond({
            'content-type': 'text/html; charset=utf-8',
            ':status': 200,
        });

        let { ifst, pLink } = chunkProvider

        webpathsToPukers[pLink.webpath] = buildOne(ifst);

        let { entrypoint, pLinks } = webpathsToPukers[pLink.webpath];
        pppLinks = pLinks

        for (let v of entrypoint.blowChunks()) {
            stream.write(v ?? '')
        }
        stream.end()
        return

    }
    else if (fileMatch = LinkPeepLocator(pppLinks, WEBROOT, path)) {
        stream.respond({
            'content-type': 'text/html; charset=utf-8',
            ':status': 200,
        });
        stream.write("TODO not implemented")
        stream.end()
        return
    }
    else {
        stream.respond({
            'content-type': 'text/html; charset=utf-8',
            ':status': 404,
        });
        stream.write('404 Not Found')
        stream.end()
        return
    }


})

/**
* 
* @param {string[]} lines - Each line of an HTTP header message
* @returns {function(keyReg: RegExp): ?string}
*/
function headerExtract(lines) {
    /**
     * @param {RegExp} keyReg - Regular expression literal matching all of a key (e.g. /^Sec-WebSocket-Key: /)
     * @returns {?string} - The value, if found
     */
    return (keyReg) => {
        return lines
            .slice(1)
            .map(l => l.split(keyReg)?.[1])
            .find(l => l)
    }
}


const WSOpcode = {
    cont: 0b0000,
    dtxt: 0b0001,
    dbin: 0b0010,
    clos: 0b1000,
    ping: 0b1001,
    pong: 0b1010,
}

const Enc = new TextEncoder()

/**
* 
* @param {string} message 
* @returns {Buffer} Message wrapped as a 1-frame WS message
*/
function prepareFrame(message) {
    const thisisMyFinalFrame = 0b10000000
    const byte1 = thisisMyFinalFrame | WSOpcode.dtxt
    const msg = Enc.encode(message)
    if (msg.byteLength > 125) {
        console.warn(`Message too long and will be truncated: ${message}`)
        msg = msg.slice(0, 125)
    }
    const isUnmasked = 0b01111111
    const byte2 = isUnmasked & msg.byteLength

    return Uint8Array.from([byte1, byte2, ...msg])
}

const websocket = createServer({ allowHalfOpen: true }, async (socket) => {

    changeReceiver.addEventListener("message", (ev) => {
        let [mode, pName] = ev.data.split(" ")
        if (mode == "built") {
            const pukerDatas = relpathsToPukers[pName]
            for (let p of pukerDatas) {
                let wp = p.pLink.webpath
                console.log(`Notifying websocket subscriber...\n`)
                process.stderr.write(`Writing '${wp}' to port ${socket.address().port}...\n`)
                socket.write(prepareFrame(wp))
            }
        }
    })

    socket.addListener("close", () => {
        console.log(`Server closing. Writing 'SERVER_CLOSE' to port ${socket}...\n`)
        socket.write(prepareFrame("SERVER_CLOSE"))
    })

    socket.addListener("data", async (data) => {
        const lines = data.toString().split('\r\n')
        const hval = headerExtract(lines)

        if (lines?.[0].endsWith('HTTP/1.1')) {
            if (!hval(/^Upgrade: /) == 'websocket') {
                socket.write(Enc.encode([
                    'HTTP/1.1 426 Upgrade Required',
                    'Upgrade: websocket',
                    'Connection: Upgrade',
                    '',
                    ''
                ].join('\r\n')))
                return
            }

            const swk = hval(/^Sec-WebSocket-Key: /)
            const magic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
            const inKey = swk + magic
            const accept = await crypto.subtle.digest('sha-1', Enc.encode(inKey))
            const b64accept = btoa(String.fromCharCode(...new Uint8Array(accept)))

            const rb = Enc.encode([
                'HTTP/1.1 101 Switching Protocols',
                'Upgrade: websocket',
                'Connection: Upgrade',
                `Sec-WebSocket-Accept: ${b64accept}`,
                '',
                ''
            ].join('\r\n'))

            socket.write(rb)
            return
        }
    })
})

process.on('SIGTERM', onSIGTERM);

function onSIGTERM() {
    server.close()
    websocket.close()
    process.exit(0);
}

websocket.listen(80)
process.stderr.write(PP.styles.blue + "websocket | Listening on port 80...\n" + PP.styles.none)

server.listen(3003)
process.stderr.write(PP.styles.blue + "https | Listening on port 3003...\n" + PP.styles.none)