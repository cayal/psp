import { decodeFrames, pongFrame, prepareFrame, WSChangeset } from './src/websockets/websocketFraming';
import { LinkPeeps, LinkPeepLocus, PLink, PLinkLocus } from './src/paths/linkPeeping';
import { PukableEntrypoint } from './src/pukables/entrypoints';
import { MessageChannel } from 'node:worker_threads'
import { FSPeep, FSPeepRoot } from './src/paths/filePeeping'
import { createSecureServer } from 'node:http2'
import { PP } from './src/fmt/ppstuff.js';
import { readFileSync } from 'node:fs';
import { L } from './src/fmt/logging';
import { createServer } from 'net';
import { Socket } from 'node:net';


L.log(`Hi (${process.pid})\n`)

const WEBROOT = 'web'
const RELOADER_SCRIPT = '\n<script>\n' + readFileSync('./src/websockets/websocketReloading.js', 'utf-8') + '\n</script>\n'
let cannotPuke = false

const { port1: changeReceiver, port2: changeTransmitter } = new MessageChannel()

const obs = new PerformanceObserver((items) => {
    L.log(`${items.getEntries()[0].name} in ${items.getEntries()[0].duration} ms\n`);
    performance.clearMarks();
});

obs.observe({ type: 'measure' });

performance.mark('a')

let webrootEntry, locus: PLinkLocus, pLinks: LinkPeeps

let rebuildLinkLocator = () => {
    if (webrootEntry) {
        webrootEntry.disconnectWatcher()
    }

    // Start by scanning the folder again and building a link tree.
    let _webrootEntry = FSPeepRoot({ entrypoint: WEBROOT })
    if (!_webrootEntry) {
        L.log(`Couldn't resolve root directory ${WEBROOT}.`)
        return process.exit(1)
    }

    let _pLinks = LinkPeeps({ entrypoint: _webrootEntry })
    if (!_pLinks) {
        L.log(`Couldn't construct LinkPeeps from entrypoint.`)
        return process.exit(1)
    }

    // Connect `change` messages from the new FSPeep to the message port.
    _webrootEntry.connectWatcher(changeTransmitter)

    let _locus = LinkPeepLocus(_pLinks)

    webrootEntry = _webrootEntry
    locus = _locus
    pLinks = _pLinks
}

rebuildLinkLocator()

performance.mark('b')
performance.measure('Built file watch tree', 'a', 'b')

L.log(`Serving from: ${webrootEntry.relpath}\n`)
for (let l of webrootEntry.repr()) {
    L.log(l)
}

const server = createSecureServer({
    maxSessionMemory: 1000,
    allowHTTP1: true,
    key: readFileSync('localhost-key.pem'),
    cert: readFileSync('localhost.pem'),
})

let buildTask = build(webrootEntry);

type Relent = { [relpath: string]: PukableEntrypoint[] }
type Webuke = { [webpath: string]: PukableEntrypoint }

async function build(root: FSPeep, relpathToBuild?: string): Promise<{ built: PukableEntrypoint[], webuke: Webuke, relent: Relent }> {

    let _relent: Relent = {}
    const _webuke: Webuke = {}

    rebuildLinkLocator()

    const buildSet: PLink[] = relpathToBuild
        ? [pLinks.links.find(x =>
            x.relpath === relpathToBuild)]
        : pLinks.links.filter(x =>
            x.ogPeep.path.name === 'index'
            && x.type == 'html')

    if (!buildSet) {
        console.error('Nothing to build.')
        cannotPuke = true;
        return { built: [], relent: {}, webuke: {} }
    }

    L.log(PP.styles.pink + `\n> Building ${PP.ar(buildSet.map((i: any) => i.relpath))}. \n` + PP.styles.none)

    let _built = []
    try {

        performance.mark('a')
        for (let iPeep of buildSet) {
            const entrypoint = new PukableEntrypoint(
                locus, iPeep.relpath, undefined, RELOADER_SCRIPT)

            _webuke[entrypoint.ownLink.webpath] = entrypoint

            for (let assoc of entrypoint.getAssociatedFilenames()) {
                if (!_relent[assoc]) { _relent[assoc] = [] }
                _relent[assoc].push(entrypoint)
            }

            _relent[entrypoint.ownLink.relpath] = [entrypoint]
            _built.push(entrypoint)
        }
        performance.mark('b')
        performance.measure('Built PukableEntrypoints from index files', 'a', 'b')
    } catch (e) {
        console.error(e)
        console.error("Ran into a problem building files.")
        cannotPuke = true
    }
    return { built: _built, relent: _relent, webuke: _webuke }
}

let enqueueReplRepr = null;

changeReceiver.addEventListener("message", async (ev: MessageEvent) => {

    let [mode, relpath] = ev.data.split(" ")
    if (mode == "change") {
        buildTask = build(webrootEntry, relpath)

        buildTask.then(builtEntrypoints => {
            enqueueReplRepr = builtEntrypoints
            changeTransmitter.postMessage(`built ${relpath}`)
        })

    } else if (mode == 'built' && (relpath === enqueueReplRepr)) {
        let { relent } = await buildTask
        let builtPoints = relent[relpath]

        for (let devInfo of builtPoints.map(x => x.debugRepr())) {
            L.log(devInfo)
        }

        enqueueReplRepr = null

    }
})

server.on('stream', async (stream, headers) => {
    if (headers[':method'] != 'GET') {
        stream.respond({
            'content-type': 'text/html; charset=utf-8',
            ':status': 501,
        });
        stream.write('Not implemented')
        stream.end()
    }

    let { webuke } = await buildTask

    const path = headers[':path'] || '/'

    let chunkProvider: PukableEntrypoint

    if (chunkProvider = webuke[path]) {
        stream.respond({
            'content-type': 'text/html; charset=utf-8',
            ':status': 200,
        });

        let entrypoint = webuke[chunkProvider.ownLink.webpath]

        for (let v of entrypoint.blowChunks()) {
            if (!v) {
                console.warn('Warning: undefined value in stream')
                continue
            }

            stream.write(v)

        }

        stream.end()
        return

    }
    else if (pLinks.links.find(pl => pl.webpath == path)) {
        let fileMatch = locus(WEBROOT)(path)
        if (fileMatch.type !== 'file' || fileMatch.result.type !== 'okFile') {
            stream.respond({
                'content-type': 'text/html; charset=utf-8',
                ':status': 404,
            });
            stream.write('404 Not Found')
            stream.end()
            return
        }

        let charset = fileMatch.result.contentType === 'text/html' ? ';charset=text/utf-8' : ''

        stream.respond({
            'content-type': `${fileMatch.result.contentType}${charset}`,
            ':status': 200,
        });

        stream.write(fileMatch.result.data)
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

const changeset = WSChangeset(changeReceiver)
const Enc = new TextEncoder()

const websocket = createServer({
    keepAlive: true,
    keepAliveInitialDelay: 1000,
}, async (socket: Socket & { id?: number }) => {
    let accept;

    let { relent } = await buildTask
    changeset.addSocket(socket, relent)

    socket.addListener("error", (e) => {
        changeReceiver.removeListener("message", changeset.listeners[socket.id].cb)
        console.log('------------')
        console.error(e.message)
        console.error(e.cause)
        console.log('------------')
    })

    socket.addListener("close", () => {
        L.log(`(Sock#${socket.id}) | Socket closing.\n`)
        changeReceiver.removeListener("message", changeset.listeners[socket.id].cb)
        socket.end()
        socket.destroy()
    })

    socket.addListener("data", async (data) => {
        if (accept !== undefined) {
            let res = decodeFrames(data)
            if (res.error == true) {
                socket.end()
                socket.destroy(new Error(res.reason))
                return

            } if (res.opcode === 'clos') {
                socket.end()

            } else if (res.opcode === 'ping') {
                console.info(`Received ping from ${socket.id}. Responding with pong...`)
                socket.write(pongFrame(res.data as number[]))

            } else if (res.opcode === 'pong') {
                changeset.keepalive(socket.id, res.data as number[])

            } else if (res.opcode === 'dtxt') {
                console.warn(`${socket.id} | Got some text.`)
                console.warn(res.data)

            } else {
                console.warn(`${socket.id} | Got a bag of data.`)
                console.warn(res.data)

            }
        }
        else {
            const lines = data.toString().split('\r\n')
            const hval = headerExtract(lines)
            if (lines?.[0].endsWith('HTTP/1.1')) {
                if (!(hval(/^Upgrade: /) === 'websocket')) {
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
                accept = await crypto.subtle.digest('sha-1', Enc.encode(inKey))
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
                socket.write(prepareFrame(`hi ${socket.id}`))
                L.log(`(Sock#${socket.id}) Updater connected. Starting pings. \n`)
                changeset.startPings(socket.id)
                return
            }
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
L.log(PP.styles.blue + "websocket | Listening on port 80...\n" + PP.styles.none)

server.listen(3003)
L.log(PP.styles.blue + "https | Listening on port 3003...\n" + PP.styles.none)